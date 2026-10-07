package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/modules/crm/publicforms"
	"nuhabit/backend/internal/modules/salesfunnel"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// crmAdvancePorts wires the CRM advance area: sales-funnel writes through
// salesfunnel.Records, its reads, notifications and employee phones through
// the stopgap SQL adapters (no owning module exposes them yet), and
// platform/whatsapp.
func crmAdvancePorts(d module.Deps) advance.Ports {
	return advance.Ports{
		Sales:         advance.SalesFunnelSQL{},
		Records:       crmSalesRecords{},
		Notifications: advance.NotificationsSQL{},
		Employees:     advance.EmployeesSQL{},
		WhatsApp:      advance.WhatsAppGateway{Client: whatsapp.New(d.Log)},
	}
}

var (
	_ advance.SalesRecords = crmSalesRecords{}
	_ publicforms.Leads    = crmFormLeads{}
)

// crmSalesRecords adapts salesfunnel.Records to CRM's write port.
type crmSalesRecords struct{ salesfunnel.Records }

func (r crmSalesRecords) CreateTask(ctx context.Context, q database.Querier, t advance.Task) (string, error) {
	return r.Records.CreateTask(ctx, q, salesfunnel.Task(t))
}

// crmFormLeads adapts salesfunnel.Records to the leads public forms create.
type crmFormLeads struct{ records salesfunnel.Records }

func (l crmFormLeads) Duplicate(ctx context.Context, q database.Querier, companyID, phone, orgName string) (string, error) {
	return l.records.DuplicateLead(ctx, q, companyID, phone, orgName)
}

func (l crmFormLeads) AppendNote(ctx context.Context, q database.Querier, leadID, note string) error {
	return l.records.AppendLeadNote(ctx, q, leadID, note)
}

func (l crmFormLeads) RecentByPhone(ctx context.Context, q database.Querier, companyID, phone string, since time.Time) (string, error) {
	return l.records.LeadByPhoneSince(ctx, q, companyID, phone, since)
}

func (l crmFormLeads) Create(ctx context.Context, q database.Querier, in publicforms.NewLead) (string, error) {
	a := in.Attribution
	return l.records.CreateFormLead(ctx, q, salesfunnel.FormLead{
		CompanyID: in.CompanyID, BranchID: in.BranchID, OrgName: in.OrgName, OrgType: in.OrgType, Source: in.Source,
		Temperature: in.Temperature,
		PicName:     in.PicName, PicPhone: in.PicPhone, PicEmail: in.PicEmail, City: in.City, Notes: in.Notes, Custom: in.Custom,
		UtmSource: a.UtmSource, UtmMedium: a.UtmMedium, UtmCampaign: a.UtmCampaign, UtmContent: a.UtmContent,
		UtmTerm: a.UtmTerm, LandingPage: a.LandingPage, Referrer: a.Referrer,
	})
}
