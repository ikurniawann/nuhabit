package appsettings

import "testing"

func TestMask(t *testing.T) {
	s := func(v string) *string { return &v }
	cases := []struct {
		in   *string
		want any
	}{
		{nil, nil},
		{s(""), nil},
		{s("abc"), "••••"},
		{s("12345678"), "••••"},
		{s("sk-123456789"), "sk-1••••••••6789"},
	}
	for _, c := range cases {
		got := Mask(c.in)
		if c.want == nil {
			if got != nil {
				t.Errorf("Mask(%v) = %q, want nil", c.in, *got)
			}
			continue
		}
		if got == nil || *got != c.want {
			t.Errorf("Mask(%q) = %v, want %q", *c.in, got, c.want)
		}
	}
}
