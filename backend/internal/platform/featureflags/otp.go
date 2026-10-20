package featureflags

import "os"

// OTPEnabled defaults to false until code-based verification is restored.
// The dataroom email verification reads it; the member portal decides at
// runtime from its configured channels and only honours OTPForcedOff.
func OTPEnabled() bool {
	return os.Getenv("OTP_ENABLED") == "true"
}

// OTPForcedOff reports OTP_ENABLED=false: member portal codes stay off even
// when a WhatsApp or email channel is configured.
func OTPForcedOff() bool {
	return os.Getenv("OTP_ENABLED") == "false"
}
