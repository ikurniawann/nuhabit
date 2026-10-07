package domain

import (
	"encoding/json"
	"strings"
)

// SSE parsing of the OpenAI stream (lib/assistant/sse.ts).

// SplitSSEEvents splits complete "\n\n"-terminated events off buffer; the
// unfinished tail is returned as rest for the next chunk.
func SplitSSEEvents(buffer string) (events []string, rest string) {
	parts := strings.Split(buffer, "\n\n")
	return parts[:len(parts)-1], parts[len(parts)-1]
}

// ExtractSSEData returns the non-empty payloads of the event's data: lines.
func ExtractSSEData(event string) []string {
	var out []string
	for _, line := range strings.Split(event, "\n") {
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		if payload := Trim(line[5:]); payload != "" {
			out = append(out, payload)
		}
	}
	return out
}

// ReadOpenAIDelta returns the text of one delta payload; ok is false for
// [DONE], deltas without content and malformed payloads.
func ReadOpenAIDelta(payload string) (string, bool) {
	if payload == "[DONE]" {
		return "", false
	}
	var v struct {
		Choices []struct {
			Delta struct {
				Content *string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if json.Unmarshal([]byte(payload), &v) != nil || len(v.Choices) == 0 || v.Choices[0].Delta.Content == nil {
		return "", false
	}
	return *v.Choices[0].Delta.Content, true
}
