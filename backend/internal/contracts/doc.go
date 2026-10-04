// Package contracts holds the cross-module event contracts: one subpackage
// per publishing context (internal/contracts/pos, .../hris), each with topic
// constants and JSON payload structs. Subscribers import a contracts package
// instead of the publisher's module. No logic and no module imports here.
package contracts
