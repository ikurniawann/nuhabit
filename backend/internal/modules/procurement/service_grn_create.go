package procurement

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// GrnCreated is createGrn's result.
type GrnCreated struct {
	Grn     *Row
	Status  string
	Message string
	Audit   audit.Entry
}

// CreateGrn is createGrn: record a receipt against a delivery (or a general
// PO without one) and, for raw materials and products, finish QC inline.
func (s *Service) CreateGrn(ctx context.Context, in *createGrnInput, user *auth.User) (*GrnCreated, error) {
	var out *GrnCreated
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		out, err = s.createGrn(ctx, tx, in, user)
		return err
	})
	return out, err
}

func (s *Service) createGrn(ctx context.Context, tx pgx.Tx, in *createGrnInput, user *auth.User) (*GrnCreated, error) {
	requested := domain.ModuleType(deref(in.ModuleType))
	deliveryID := deref(in.DeliveryID)
	autoDelivery := deliveryID == ""
	if autoDelivery {
		if requested != "general" || deref(in.PoID) == "" {
			return nil, badRequest("Delivery wajib dipilih untuk penerimaan ini")
		}
		id, err := s.createAutoDelivery(ctx, tx, *in.PoID, user.ID)
		if err != nil {
			return nil, err
		}
		deliveryID = id
	}

	delivery, errs, err := s.validateDeliveryCanReceive(ctx, tx, deliveryID)
	if err != nil {
		return nil, err
	}
	if delivery == nil || delivery.Str("purchase_order_id") == "" {
		msg := strings.Join(errs, "; ")
		if msg == "" {
			msg = "Delivery tidak valid untuk penerimaan barang"
		}
		return nil, badRequest(msg)
	}
	poID := delivery.Str("purchase_order_id")
	moduleType := requested
	if !autoDelivery {
		po, err := s.rows.One(ctx, tx, `SELECT module_type FROM purchase_orders WHERE id = $1`, poID)
		if err != nil || po == nil {
			return nil, badRequest("Purchase order tidak ditemukan untuk delivery ini")
		}
		moduleType = domain.ModuleType(po.Str("module_type"))
		if in.ModuleType != nil && *in.ModuleType != moduleType {
			return nil, badRequest("module_type tidak sesuai purchase order (" + moduleType + ")")
		}
	}
	lines := in.Items
	if moduleType != "general" {
		lines = make([]grnLineInput, len(in.Items))
		for i, l := range in.Items {
			a, r := domain.NormalizeQc(l.QtyDiterima, l.QtyAccepted, l.QtyRejected)
			l.QtyAccepted, l.QtyRejected = &a, &r
			lines[i] = l
		}
	}
	usesVendor := moduleType != "raw_material"

	scope, err := s.Scope(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	business, err := s.receivingScope(ctx, tx, in.WarehouseID, scope)
	if err != nil {
		return nil, err
	}
	if business != nil {
		s.nonFatal(ctx, tx, "Failed to backfill PO business scope", func(sp pgx.Tx) error {
			_, err := sp.Exec(ctx, `UPDATE purchase_orders SET company_id = $2, branch_id = $3 WHERE id = $1`, poID, business.CompanyID, business.BranchID)
			return err
		})
		s.nonFatal(ctx, tx, "Failed to backfill delivery business scope", func(sp pgx.Tx) error {
			_, err := sp.Exec(ctx, `UPDATE deliveries SET company_id = $2, branch_id = $3 WHERE id = $1`, deliveryID, business.CompanyID, business.BranchID)
			return err
		})
	}

	poItems, err := s.poItemsForReceive(ctx, tx, poID, false)
	if err != nil {
		return nil, badRequest(pgMessage(err))
	}
	if len(errs) > 0 {
		statusOnly := false
		for _, e := range errs {
			if strings.Contains(e, "status") {
				statusOnly = true
			}
		}
		if !statusOnly {
			return nil, badRequest(strings.Join(errs, "; "))
		}
	}
	receive := make([]domain.ReceiveLine, len(lines))
	for i, l := range lines {
		receive[i] = l.receive()
	}
	skus, err := domain.ValidateReceiveLines(receive, poItems)
	if err != nil {
		return nil, receiveErr(err)
	}

	number, err := s.nextNumber(ctx, tx, "grn", "nomor_grn", domain.DailyPrefix("GRN", s.now().In(s.loc)))
	if err != nil {
		return nil, err
	}
	diterima, ditolak := domain.GrnTotals(receive)
	var previous int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM grn WHERE delivery_id = $1 AND is_active = true`, deliveryID).Scan(&previous); err != nil {
		return nil, err
	}
	initial := domain.InitialGrnStatus(moduleType, diterima, ditolak)
	receivedOn := s.now().UTC().Format("2006-01-02")
	if deref(in.TanggalPenerimaan) != "" {
		receivedOn = *in.TanggalPenerimaan
	}
	var supplierID, vendorID *string
	if usesVendor {
		vendorID = delivery.StrPtr("vendor_id")
	} else {
		supplierID = delivery.StrPtr("supplier_id")
	}
	var companyID, branchID *string
	if business != nil {
		companyID, branchID = &business.CompanyID, &business.BranchID
	}
	grn, err := s.rows.One(ctx, tx, `INSERT INTO grn
		(nomor_grn, delivery_id, purchase_order_id, supplier_id, vendor_id, company_id, branch_id, tanggal_penerimaan,
		 no_surat_jalan, catatan, status, total_item_diterima, total_item_ditolak, receive_count, penerima_id, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::date, $9, $10, $11, $12::numeric, $13::numeric, $14, $15, $15) RETURNING *`,
		number, deliveryID, poID, supplierID, vendorID, companyID, branchID, receivedOn,
		delivery.StrPtr("no_surat_jalan"), nonEmpty(in.Catatan), initial, diterima, ditolak, previous+1, user.ID)
	if err != nil {
		return nil, serverMessage(err, "Gagal menyimpan dokumen penerimaan barang")
	}
	grnID := grn.Str("id")

	var materialIDs []string
	for _, l := range lines {
		if deref(l.RawMaterialID) != "" {
			materialIDs = append(materialIDs, *l.RawMaterialID)
		}
	}
	shelfLife, err := s.ports.Catalog.ShelfLifeDays(ctx, tx, uniqueStrings(materialIDs))
	if err != nil {
		shelfLife = map[string]*float64{}
	}
	type created struct {
		ID, PoItemID, RawMaterialID, ProductID string
		QtyDiterima                            float64
	}
	createdItems := make([]created, 0, len(lines))
	auditItems := make([]*Row, 0, len(lines))
	for i, l := range lines {
		var batch, expiry *string
		hasBatch := deref(l.RawMaterialID) != ""
		if hasBatch {
			if b := strings.TrimSpace(deref(l.BatchNumber)); b != "" {
				batch = &b
			}
			expiry = nonEmpty(l.ExpiryDate)
			if expiry == nil {
				expiry = domain.DefaultExpiryDate(receivedOn, shelfLife[*l.RawMaterialID])
			}
		}
		var c created
		if err := tx.QueryRow(ctx, `INSERT INTO grn_items
			(grn_id, delivery_id, purchase_order_item_id, raw_material_id, product_id, supply_item_id, pos_sku_id, qty_diterima, qty_ditolak,
			 satuan_id, kondisi, catatan, warehouse_id, qc_status, batch_number, expiry_date)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14, $15::text::date)
			RETURNING id::text, COALESCE(purchase_order_item_id::text, ''), COALESCE(raw_material_id::text, ''), COALESCE(product_id::text, ''), qty_diterima::float8`,
			grnID, deliveryID, l.PurchaseOrderItemID, nonEmpty(l.RawMaterialID), nonEmpty(l.ProductID), nonEmpty(l.SupplyItemID), skus[i],
			l.QtyDiterima, l.QtyDitolak, l.SatuanID, l.Kondisi, nonEmpty(l.Catatan), in.WarehouseID, batch, expiry).
			Scan(&c.ID, &c.PoItemID, &c.RawMaterialID, &c.ProductID, &c.QtyDiterima); err != nil {
			return nil, serverMessage(err, "Gagal menyimpan item penerimaan barang")
		}
		createdItems = append(createdItems, c)
		auditItem := obj("raw_material_id", nonEmpty(l.RawMaterialID), "product_id", nonEmpty(l.ProductID), "supply_item_id", nonEmpty(l.SupplyItemID),
			"qty_diterima", l.QtyDiterima, "qty_ditolak", l.QtyDitolak, "batch_number", nil, "expiry_date", nil)
		if hasBatch {
			auditItem.Set("batch_number", batch).Set("expiry_date", expiry)
		}
		auditItems = append(auditItems, auditItem)
	}

	if moduleType == "general" && initial != domain.GrnRejected {
		if err := s.publishSupplyStock(ctx, tx, grn, lines, poItems, in.WarehouseID, companyID, branchID, user.ID); err != nil {
			return nil, err
		}
	}

	status := initial
	if moduleType != "general" && initial == domain.GrnPending {
		var qcItems []QcItem
		remaining := append([]grnLineInput{}, lines...)
		for _, c := range createdItems {
			if c.QtyDiterima <= 0 {
				continue
			}
			idx := -1
			for j, req := range remaining {
				if (c.PoItemID != "" && deref(req.PurchaseOrderItemID) == c.PoItemID) ||
					(c.RawMaterialID != "" && deref(req.RawMaterialID) == c.RawMaterialID) ||
					(c.ProductID != "" && deref(req.ProductID) == c.ProductID) {
					idx = j
					break
				}
			}
			var req *grnLineInput
			if idx >= 0 {
				r := remaining[idx]
				req = &r
				remaining = append(remaining[:idx], remaining[idx+1:]...)
			}
			var accepted, rejected *float64
			var catatan *string
			if req != nil {
				accepted, rejected, catatan = req.QtyAccepted, req.QtyRejected, req.Catatan
			}
			a, r := domain.NormalizeQc(c.QtyDiterima, accepted, rejected)
			qcItems = append(qcItems, QcItem{GrnItemID: c.ID, RawMaterialID: nilIfEmpty(c.RawMaterialID), ProductID: nilIfEmpty(c.ProductID),
				QtyInspected: c.QtyDiterima, QtyAccepted: a, QtyRejected: r, Catatan: catatan})
		}
		if len(qcItems) > 0 {
			acc, rej := make([]float64, len(qcItems)), make([]float64, len(qcItems))
			for i, q := range qcItems {
				acc[i], rej[i] = q.QtyAccepted, q.QtyRejected
			}
			result, err := s.submitQc(ctx, tx, QcInput{GrnID: grnID, Status: domain.QcOverallStatus(acc, rej), Catatan: nonEmpty(in.Catatan), Items: qcItems, UserID: user.ID})
			if err != nil {
				var apiErr *httpx.Error
				switch {
				case errors.As(err, &apiErr):
					return nil, err
				case isPgError(err):
					// A query-builder error object is not an Error instance.
					return nil, httpx.Status(500, "Gagal menyelesaikan QC dan posting stok pada penerimaan")
				}
				return nil, httpx.Status(500, err.Error())
			}
			status = result.GrnStatus
		}
	}

	switch {
	case status == domain.GrnPending || moduleType == "general":
		if status != domain.GrnRejected {
			if _, err := tx.Exec(ctx, `UPDATE deliveries SET status = 'delivered', updated_at = $2 WHERE id = $1`, deliveryID, s.now()); err != nil {
				return nil, err
			}
		} else if err := s.updateDeliveryStatusAfterGrn(ctx, tx, deliveryID, status); err != nil {
			return nil, err
		}
		if err := s.updatePOStatusAfterGrn(ctx, tx, poID); err != nil {
			return nil, err
		}
	case status == domain.GrnRejected && initial == domain.GrnRejected:
		if err := s.updateDeliveryStatusAfterGrn(ctx, tx, deliveryID, status); err != nil {
			return nil, err
		}
		if err := s.updatePOStatusAfterGrn(ctx, tx, poID); err != nil {
			return nil, err
		}
	}
	s.nonFatal(ctx, tx, "[GRN] Vendor credit sync error", func(sp pgx.Tx) error {
		return s.syncRejectCredits(ctx, sp, grnID, "receive_reject", user.ID)
	})
	if moduleType == "general" && status != domain.GrnRejected {
		if err := publishGrnPosted(ctx, tx, grnID, user.ID); err != nil {
			return nil, err
		}
	}
	grn.Set("status", status)
	return &GrnCreated{
		Grn: grn, Status: status, Message: domain.GrnCreatedMessage(number, status, moduleType, nil),
		Audit: audit.Entry{ActorID: user.ID, ActorName: nonEmpty(&user.FullName), Action: "grn.post", Entity: "grn", EntityID: &grnID, EntityLabel: &number,
			After: obj("status", status, "warehouse_id", in.WarehouseID, "purchase_order_id", poID, "items", auditItems)},
	}, nil
}

// createAutoDelivery opens the implicit delivery of a general PO receipt.
func (s *Service) createAutoDelivery(ctx context.Context, tx pgx.Tx, poID, userID string) (string, error) {
	if errs, err := s.validatePOCanDelivery(ctx, tx, poID); err != nil {
		return "", err
	} else if len(errs) > 0 {
		return "", badRequest(strings.Join(errs, " "))
	}
	po, err := s.rows.One(ctx, tx, `SELECT id, vendor_id, company_id, branch_id, module_type FROM purchase_orders WHERE id = $1::text::uuid`, poID)
	if err != nil || po == nil {
		return "", badRequest("Purchase order tidak ditemukan")
	}
	if po.Str("module_type") != "general" {
		return "", badRequest("Penerimaan otomatis hanya untuk purchase order barang operasional")
	}
	today := s.now().UTC().Format("2006-01-02")
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO deliveries
		(purchase_order_id, supplier_id, vendor_id, tanggal_kirim, no_surat_jalan, tanggal_estimasi_tiba, status, company_id, branch_id, created_by)
		VALUES ($1, NULL, $2, $3::text::date, $4, $3::text::date, 'pending', $5, $6, $7) RETURNING id::text`,
		po.Str("id"), po.StrPtr("vendor_id"), today, "AUTO-"+today, po.StrPtr("company_id"), po.StrPtr("branch_id"), userID).Scan(&id); err != nil {
		s.log.ErrorContext(ctx, "Auto delivery insert error", "error", err)
		return "", httpx.Status(500, "Gagal menyiapkan penerimaan barang operasional")
	}
	return id, nil
}
