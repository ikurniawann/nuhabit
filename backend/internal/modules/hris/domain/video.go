package domain

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	youtubeID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	vimeoID   = regexp.MustCompile(`^\d{6,12}$`)
)

// ParseVideoURL is parseVideoUrl: a YouTube or Vimeo URL as provider + id;
// ok=false for anything else (other hosts, non-http schemes, bad ids).
func ParseVideoURL(input string) (provider, id string, ok bool) {
	raw := JSTrim(input)
	if raw == "" {
		return "", "", false
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", "", false
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	parts := []string{}
	for _, p := range strings.Split(u.EscapedPath(), "/") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	at := func(i int) string {
		if i >= 0 && i < len(parts) {
			return parts[i]
		}
		return ""
	}
	youtube := func(id string) (string, string, bool) { return "youtube", id, youtubeID.MatchString(id) }
	vimeo := func(id string) (string, string, bool) { return "vimeo", id, vimeoID.MatchString(id) }

	switch host {
	case "youtu.be":
		path := strings.TrimPrefix(u.EscapedPath(), "/")
		return youtube(strings.Split(path, "/")[0])
	case "youtube.com", "m.youtube.com", "youtube-nocookie.com":
		if u.EscapedPath() == "/watch" {
			return youtube(u.Query().Get("v"))
		}
		switch at(0) {
		case "embed", "shorts", "v":
			return youtube(at(1))
		}
	case "vimeo.com":
		return vimeo(at(len(parts) - 1))
	case "player.vimeo.com":
		if at(0) == "video" {
			return vimeo(at(1))
		}
	}
	return "", "", false
}
