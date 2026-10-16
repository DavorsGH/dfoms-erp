# Contract Profitability report (staff)

## When to use this report

Use **Reports → Contract Profitability** to see, for one month, how much each client contract earned and cost: **revenue, labour, direct costs and margin per contract**. This is different from **Budget vs Actual**, which compares planned spending with actual spending.

## Open the report

1. In the left menu, open **Reports**.
2. Choose **Contract Profitability**.

## Set the period and options

1. Choose the **Month** and **Year** at the top of the report.
2. Optional **Overhead allocation**:
   - **None (overhead separate)** — company overhead is not shared out to contracts.
   - **By revenue share** — overhead is shared by each contract's share of revenue.
   - **By headcount** — overhead is shared by the number of staff on each contract.
3. The table lists each **Contract** with **Revenue**, **Labour**, **Direct costs**, **Gross margin**, **Gross margin %**, **Overhead share** (when allocation is on), **Net margin** and **Net margin %**.
4. Read the notes under the table — for example payroll not yet locked, voided income, or expenses without a project.

## How amounts reach a contract

- **Revenue** comes from client invoices raised under that contract. Income that is not linked to a client invoice is not allocated to any contract.
- **Direct costs** come from Expense Register entries, Accounts Payable bills and Supplier Contracts tagged to a **project**.
- **Labour** comes from payroll for staff assigned to a **project**.
- A project's costs and labour count towards a contract **only when the project is linked to that contract**. Set this in **Administration → Projects**, field **Client Contract**. If a project shows **None (internal / overhead)**, its costs and labour stay in overhead.

If a contract shows **0** even though work was done, check: (1) the month's client invoice exists and belongs to the contract, (2) the projects for that client have **Client Contract** set, and (3) the costs are tagged to those projects.

## Tips

- The report follows the **business unit** selected in the header (or all units when **View All Businesses** is selected).
- Labour may show as an estimate until payroll for the month is locked — follow the note on screen.
- To tag costs to projects, see "Tagging costs to a Contract / Project".
