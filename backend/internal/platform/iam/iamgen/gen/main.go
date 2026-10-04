// Command gen regenerates internal/platform/iam/prefixes_gen.go from
// frontend/src/lib/iam/prefixes.ts. Run from backend/: go generate ./internal/platform/iam
package main

import (
	"flag"
	"log"
	"os"

	"nuhabit/backend/internal/platform/iam/iamgen"
)

func main() {
	src := flag.String("src", "../../../../frontend/src/lib/iam/prefixes.ts", "path to prefixes.ts")
	out := flag.String("out", "prefixes_gen.go", "output Go file")
	flag.Parse()

	raw, err := os.ReadFile(*src)
	if err != nil {
		log.Fatal(err)
	}
	entries, err := iamgen.Parse(string(raw))
	if err != nil {
		log.Fatal(err)
	}
	code, err := iamgen.Render(entries)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, code, 0o644); err != nil {
		log.Fatal(err)
	}
}
