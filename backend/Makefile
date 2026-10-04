.DEFAULT_GOAL := help
.PHONY: help run test test-unit vet fmt lint migrate migrate-apply generate build docker

# Integration tests run against the local database unless overridden.
TEST_DATABASE_URL ?= postgres://postgres@localhost:55432/nuhabit

help: ## List targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

run: ## Run the API (reads .env.local)
	go run ./cmd/api

test: ## Unit + integration tests
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test ./... -count=1

test-unit: ## Unit tests only (integration tests skip)
	TEST_DATABASE_URL= go test ./...

vet: ## go vet
	go vet ./...

fmt: ## gofmt -w
	gofmt -w .

lint: vet ## vet + gofmt check
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

migrate: ## Dry run: list pending migrations
	go run ./cmd/migrate

migrate-apply: ## Apply pending migrations
	go run ./cmd/migrate -apply

generate: ## Regenerate IAM prefixes from frontend/src/lib/iam/prefixes.ts
	go generate ./internal/platform/iam

build: ## Build bin/api and bin/migrate
	go build -trimpath -o bin/api ./cmd/api
	go build -trimpath -o bin/migrate ./cmd/migrate

docker: ## Build the container image
	docker build -t nuhabit-api .
