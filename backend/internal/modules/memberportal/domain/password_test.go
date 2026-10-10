package domain

import "testing"

func TestLoginKeyAndLookup(t *testing.T) {
	for _, c := range []struct{ in, key, digits, email string }{
		{"0812-3456-789", "628123456789", "628123456789", ""},
		{"+62 812 3456 789", "628123456789", "628123456789", ""},
		{" Budi@Example.ID ", "budi@example.id", "", "budi@example.id"},
		{"Budi", "budi", "", ""},
		{"0812", "0812", "", ""},
	} {
		if got := LoginKey(c.in); got != c.key {
			t.Errorf("LoginKey(%q) = %q, want %q", c.in, got, c.key)
		}
		if digits, email := LoginLookup(c.in); digits != c.digits || email != c.email {
			t.Errorf("LoginLookup(%q) = %q, %q, want %q, %q", c.in, digits, email, c.digits, c.email)
		}
	}
}

func TestNewPasswordProblem(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"abc1234", "Password must be 8 to 72 characters"},
		{"abcdefgh", "Password must contain at least one letter and one digit"},
		{"12345678", "Password must contain at least one letter and one digit"},
		{"abcd1234", ""},
		{"pässwörd1", ""},
		{string(make([]rune, 73)) + "a1", "Password must be 8 to 72 characters"},
	} {
		if got := NewPasswordProblem(c.in); got != c.want {
			t.Errorf("NewPasswordProblem(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestMaskPhone(t *testing.T) {
	if got := MaskPhone("628123456789"); got != "0812****789" {
		t.Errorf("MaskPhone = %q", got)
	}
	if got := MaskPhone("1234567"); got != "*******" {
		t.Errorf("short MaskPhone = %q", got)
	}
}
