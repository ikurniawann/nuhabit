package posops

import (
	"context"
	"regexp"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/scope"
)

// Caller is the signed-in staff member as the stall rules see them: the
// stall switcher cookie and the central cashier grant come from the
// request.
type Caller struct {
	UserID string
	Role   string
	// ActiveStall is the nuhabit-active-stall cookie ("" when unset).
	ActiveStall string
	// CentralMenu is the pos.cashier.central grant.
	CentralMenu bool
}

// activeStall is resolveActiveStallFromCookies' result.
type activeStall struct {
	Mode  string
	Stall *domain.Stall
}

var activeStallID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func (s *Service) activeStall(ctx context.Context, cookie string) (activeStall, error) {
	switch cookie {
	case "":
		return activeStall{Mode: domain.StallModeUnset}, nil
	case domain.StallModeAll:
		return activeStall{Mode: domain.StallModeAll}, nil
	}
	if !activeStallID.MatchString(cookie) {
		return activeStall{Mode: domain.StallModeUnset}, nil
	}
	st, err := s.ports.Stalls.Active(ctx, s.db, cookie)
	if err != nil || st == nil {
		return activeStall{Mode: domain.StallModeUnset}, err
	}
	return activeStall{Mode: domain.StallModeStall, Stall: st}, nil
}

func (a activeStall) id() string {
	if a.Stall == nil {
		return ""
	}
	return a.Stall.ID
}

// centralGate is loadCentralCashierGate.
type centralGate struct {
	CanCentralCheckout bool
	ActiveMode         string
}

func (s *Service) centralGate(ctx context.Context, c Caller) (centralGate, error) {
	flags, err := s.ports.Stalls.Flags(ctx, s.db, c.UserID)
	if err != nil {
		return centralGate{}, err
	}
	active, err := s.activeStall(ctx, c.ActiveStall)
	return centralGate{CanCentralCheckout: flags.CanCentralCheckout, ActiveMode: active.Mode}, err
}

// stallAccess is getStallAccess: the switcher's stalls, every active stall
// of the branch for full-access users.
func (s *Service) stallAccess(ctx context.Context, userID, role string, branchID *string) ([]domain.Stall, error) {
	assigned, err := s.ports.Stalls.Assigned(ctx, s.db, userID)
	if err != nil {
		return nil, err
	}
	flags, err := s.ports.Stalls.Flags(ctx, s.db, userID)
	if err != nil {
		return nil, err
	}
	mainStorage := false
	for _, st := range assigned {
		mainStorage = mainStorage || st.IsDefault
	}
	if !domain.StallAllAccess(role, flags.CanSwitchStall, mainStorage) {
		return domain.SortStalls(assigned), nil
	}
	all, err := s.ports.Stalls.Branch(ctx, s.db, nonEmptyPtr(branchID))
	if err != nil {
		return nil, err
	}
	return domain.SortStalls(all), nil
}

// sellContext gathers what resolvePosSell{Scope,Stall}ForUser read.
type sellContext struct {
	assigned  []string
	active    activeStall
	unscoped  bool
	canSwitch bool
	defaultID string // users.default_warehouse_id
}

func (s *Service) sellContext(ctx context.Context, c Caller) (sellContext, error) {
	var sc sellContext
	stalls, err := s.ports.Stalls.Assigned(ctx, s.db, c.UserID)
	if err != nil {
		return sc, err
	}
	for _, st := range stalls {
		sc.assigned = append(sc.assigned, st.ID)
	}
	if sc.active, err = s.activeStall(ctx, c.ActiveStall); err != nil {
		return sc, err
	}
	us, err := scope.Load(ctx, s.db, c.UserID)
	if err != nil {
		return sc, err
	}
	sc.unscoped = us.Unscoped
	flags, err := s.ports.Stalls.Flags(ctx, s.db, c.UserID)
	if err != nil {
		return sc, err
	}
	sc.canSwitch = flags.CanSwitchStall
	if flags.DefaultWarehouseID != nil {
		sc.defaultID = *flags.DefaultWarehouseID
	}
	return sc, nil
}

func (sc sellContext) input(mode string) domain.SellStallInput {
	def := sc.defaultID
	if def == "" && len(sc.assigned) > 0 {
		def = sc.assigned[0]
	}
	return domain.SellStallInput{ActiveMode: mode, ActiveStallID: sc.active.id(), AssignedIDs: sc.assigned, DefaultWarehouseID: def}
}

const outsideAssignment = "Stall aktif di luar penempatan Anda"

// sellScope is resolvePosSellScopeForUser.
func (s *Service) sellScope(ctx context.Context, c Caller) (domain.SellScope, error) {
	sc, err := s.sellContext(ctx, c)
	if err != nil {
		return domain.SellScope{}, err
	}
	scope := domain.ResolveSellScope(sc.input(sc.active.Mode), sc.unscoped)
	if scope.Mode == "stall" && !domain.SellStallAllowed(scope.WarehouseID, sc.assigned, sc.canSwitch, sc.unscoped, sc.defaultID) {
		return domain.SellScope{Mode: "blocked", Reason: "no_stall", Message: outsideAssignment}, nil
	}
	return scope, nil
}

// sellStall is resolvePosSellStallForUser.
func (s *Service) sellStall(ctx context.Context, c Caller) (domain.SellStall, error) {
	sc, err := s.sellContext(ctx, c)
	if err != nil {
		return domain.SellStall{}, err
	}
	mode := sc.active.Mode
	if mode == domain.StallModeUnset && len(sc.assigned) == 0 && sc.unscoped {
		mode = domain.StallModeAll
	}
	stall := domain.ResolveSellStall(sc.input(mode))
	if stall.OK && !domain.SellStallAllowed(stall.WarehouseID, sc.assigned, sc.canSwitch, sc.unscoped, sc.defaultID) {
		return domain.SellStall{Reason: "no_stall", Message: outsideAssignment}, nil
	}
	return stall, nil
}

// productScope is resolvePosProductStallScope's result. Mode "all" sells
// every product; "none" none (Reason); "ids" the listed ones.
type productScope struct {
	Mode         string
	Reason       string
	ProductIDs   []string
	WarehouseIDs []string
	ActiveMode   string
}

// productStallScope decides which POS products the caller may sell: the
// central cashier in "Semua Stall" mode gets the union of their stalls, a
// full-access user every product, a stall cashier their one stall.
func (s *Service) productStallScope(ctx context.Context, c Caller, branchID *string) (productScope, error) {
	gate, err := s.centralGate(ctx, c)
	if err != nil {
		return productScope{}, err
	}
	if domain.CanSellMixedStall(c.CentralMenu, gate.CanCentralCheckout, gate.ActiveMode) {
		stalls, err := s.stallAccess(ctx, c.UserID, c.Role, branchID)
		if err != nil {
			return productScope{}, err
		}
		ids := make([]string, len(stalls))
		for i, st := range stalls {
			ids[i] = st.ID
		}
		return s.stallProducts(ctx, ids, gate.ActiveMode)
	}
	sell, err := s.sellScope(ctx, c)
	if err != nil {
		return productScope{}, err
	}
	switch sell.Mode {
	case "all":
		return productScope{Mode: "all", ActiveMode: gate.ActiveMode}, nil
	case "blocked":
		return productScope{Mode: "none", Reason: sell.Reason, ActiveMode: gate.ActiveMode}, nil
	}
	stall, err := s.sellStall(ctx, c)
	if err != nil {
		return productScope{}, err
	}
	if !stall.OK {
		return productScope{Mode: "none", Reason: stall.Reason, ActiveMode: gate.ActiveMode}, nil
	}
	return s.stallProducts(ctx, []string{stall.WarehouseID}, gate.ActiveMode)
}

func (s *Service) stallProducts(ctx context.Context, warehouseIDs []string, activeMode string) (productScope, error) {
	ids := []string{}
	if len(warehouseIDs) > 0 {
		found, err := s.ports.Inventory.ProductIDsForStalls(ctx, s.db, warehouseIDs)
		if err != nil {
			return productScope{}, err
		}
		ids = append(ids, found...)
	}
	return productScope{Mode: "ids", ProductIDs: ids, WarehouseIDs: warehouseIDs, ActiveMode: activeMode}, nil
}
