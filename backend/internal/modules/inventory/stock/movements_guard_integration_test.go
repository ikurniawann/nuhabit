package stock_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/inventory/stock"
)

// Both {id}/movements lists answer 403 to staff without the menu, as the
// TS routes' requireIamMenuPrefix did.
func TestMovementListsNeedMenu(t *testing.T) {
	k := kittest.Setup(t, map[string][]string{"hris": nil}, nil, "pos")
	k.Mount(stock.Routes(k.Env, stock.Ports{Procurement: fakeProcurement{}, PosSkus: &fakeSkus{}, Journals: &recordingJournals{}}))
	const id = "00000000-0000-0000-0000-000000000001"
	k.Fail("GET", "/api/inventory/"+id+"/movements", nil, http.StatusForbidden, "Insufficient permissions")
	k.Fail("GET", "/api/purchasing/inventory/"+id+"/movements", nil, http.StatusForbidden, "Insufficient permissions")
}
