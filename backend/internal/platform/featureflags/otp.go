package featureflags

import "os"

// OTPEnabled defaults to false until code-based verification is restored.
func OTPEnabled() bool {
	return os.Getenv("OTP_ENABLED") == "true"
}
