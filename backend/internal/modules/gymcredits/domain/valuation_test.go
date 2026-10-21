package domain

import "testing"

func TestThreeCreditLotClosesAtZero(t *testing.T) {
	value := LotValueSen(100_000)
	if value != 10_000_000 {
		t.Fatalf("value = %d sen", value)
	}
	// One credit at a time: the moves differ by a sen and sum to the lot.
	var posted int64
	want := []int64{3_333_333, 3_333_334, 3_333_333}
	for used := 0; used < 3; used++ {
		got := MoveValueSen(value, 3, used, -1)
		if got != want[used] {
			t.Fatalf("move %d = %d, want %d", used+1, got, want[used])
		}
		posted += got
	}
	if left := value - posted; left != 0 {
		t.Fatalf("deferred revenue left after the last credit = %d sen", left)
	}
	if UnusedValueSen(value, 3, 3) != 0 || UnusedValueSen(value, 3, 1) != 6_666_667 {
		t.Fatalf("unused value = %d / %d", UnusedValueSen(value, 3, 3), UnusedValueSen(value, 3, 1))
	}
}

func TestMoveValueSymmetry(t *testing.T) {
	value := LotValueSen(100_000)
	// Two credits out, one back, two out again: in and out cancel at the sen.
	out2 := MoveValueSen(value, 3, 0, -2)
	back1 := MoveValueSen(value, 3, 2, 1)
	out2b := MoveValueSen(value, 3, 1, -2)
	if out2 != 6_666_667 || back1 != 3_333_334 || out2b != 6_666_667 {
		t.Fatalf("moves = %d %d %d", out2, back1, out2b)
	}
	if out2-back1+out2b != value {
		t.Fatalf("net posted %d != %d", out2-back1+out2b, value)
	}
	// Beyond the lot nothing more is valued.
	if MoveValueSen(value, 3, 3, -1) != 0 || MoveValueSen(value, 0, 0, -1) != 0 {
		t.Fatal("moves past the lot or of an empty lot must be worth nothing")
	}
	if SenToIdr(3_333_334) != 33_333.34 {
		t.Fatalf("SenToIdr = %v", SenToIdr(3_333_334))
	}
}
