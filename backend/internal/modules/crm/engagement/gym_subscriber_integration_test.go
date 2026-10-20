package engagement

import (
	"context"
	"testing"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

type recordingChannels struct{ sent []string }

func (c *recordingChannels) Send(customerID, title, body string) {
	c.sent = append(c.sent, customerID+"|"+title+"|"+body)
}

// The gym publisher writes the inbox row itself; the subscriber only
// delivers: one push and one WhatsApp/email hand-off per event, even when the
// delivery runs again on another replica.
func TestGymNotificationSubscriber(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	d := testutil.Deps(t, nil)
	push, channels := &recordingPush{}, &recordingChannels{}
	replicas := []*outbox.Bus{outbox.NewBus(nil, d.Log), outbox.NewBus(nil, d.Log)}
	for _, bus := range replicas {
		Subscribe(bus, d, Ports{Push: push, Gym: channels})
	}
	if err := replicas[0].Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	member := crmtest.Scalar[string](t, tx, `INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Gym') RETURNING id::text`, "+6295"+testutil.RandomHex(4))
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM crm.member_push_claims WHERE recipient IN ($1, 'channels:' || $1)`, member)
	})
	if err := outbox.Publish(ctx, tx, gym.TopicMemberNotified, member, gym.MemberNotified{
		CustomerID: member, Type: "gym_class_reminder", Title: "Kelas segera dimulai", Body: "Mulai 18.00",
	}); err != nil {
		t.Fatal(err)
	}
	for _, bus := range replicas {
		crmtest.MustExec(t, tx, `UPDATE platform.outbox_deliveries d SET delivered_at = NULL FROM platform.outbox_events e
			WHERE e.id = d.event_id AND e.key = $1 AND d.subscriber = $2`, member, subscriberGymNotice)
		if n, err := bus.Dispatch(ctx, tx); err != nil || n != 1 {
			t.Fatalf("dispatch: %d %v", n, err)
		}
	}
	if len(push.members) != 1 || push.members[0] != member || push.types[0] != "gym_class_reminder" {
		t.Fatalf("pushes = %v %v", push.members, push.types)
	}
	if len(channels.sent) != 1 || channels.sent[0] != member+"|Kelas segera dimulai|Mulai 18.00" {
		t.Fatalf("channel sends = %v", channels.sent)
	}
	if n := crmtest.Scalar[int](t, tx, `SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1`, member); n != 0 {
		t.Fatalf("subscriber wrote %d inbox rows; the publisher owns them", n)
	}
}
