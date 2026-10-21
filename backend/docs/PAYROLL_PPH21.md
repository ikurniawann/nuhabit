# PPh 21 on one-off payroll additions

`internal/modules/payroll/domain/calculator.go` withholds PPh 21 with the
progressive annual method: the month's regular pay is annualised (x12), PTKP
and the capped jabatan expense come off, the brackets of `payroll_tax_config`
apply, and one twelfth is withheld each month. The calculator does not use
the TER monthly rates, so there is no December true-up.

Payroll additions (`hris.payroll_additions`, for example a paid coach
incentive) are paid once. Annualising them would tax twelve months of an
amount that arrives in one, so the slip treats them as irregular income:

```
tax on the addition  = PPh21(annual regular + addition) - PPh21(annual regular)
withheld this month  = PPh21(annual regular) / 12 + tax on the addition
```

`Input.IrregularIncome` carries the additions; `Input.Bonus` still carries
them into the gross and the slip. `Result.Pph21Annual` and
`Result.TaxableIncome` include the addition once, `Result.Pph21Irregular`
is the tax on it, `Result.Pph21Deduction` is the month's withholding.

## Example (default config, TK/0, BPJS and Tapera enrolled)

Base salary 10,000,000, fixed allowance 2,000,000, monthly BPJS employee
deductions 692,770. Annual regular pay 144,000,000; taxable
129,686,760; annual tax 5,352,900; withheld 446,075 a month.

A 30,000,000 incentive lands in May.

| | annual regular | with the addition |
| --- | ---: | ---: |
| gross | 144,000,000 | 174,000,000 |
| taxable (less BPJS 8,313,240, jabatan 6,000,000) | 129,686,760 | 159,686,760 |
| PKP (less PTKP 54,000,000, whole thousands) | 75,686,000 | 105,686,000 |
| tax | 5,352,900 | 9,852,900 |

Tax on the addition: 9,852,900 - 5,352,900 = 4,500,000. May withholds
446,075 + 4,500,000 = 4,946,075.

Annualising the 42,000,000 month instead would have put 185,686,000 of PKP
in the 25% bracket and withheld 6,493,458, an over-withholding of
1,547,383 that the employee would only get back at the annual return.
Inside one bracket both methods agree (a 5,000,000 addition at 15% adds
750,000 either way).

## Additions after a draft run was calculated

`payroll.AddToOpenPeriod` stores the addition in the first period whose run
is missing or still a draft. When that draft was already calculated, the
slips are stale: the run gets `needs_recalculation = true` and the payroll
run page shows "Perlu dihitung ulang" until it is calculated again, which
clears the flag. A run that has moved past draft sends the addition to the
next period.
