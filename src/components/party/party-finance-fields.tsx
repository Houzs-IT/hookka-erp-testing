// The finance fields every party master carries (owner 2026-10-17, Finance v2
// party form: "TIN · e-Invoice", "SST Reg. No. · e-Invoice", "Currency",
// "Bank & account no."): one block shared by the customer, supplier and
// other-party forms, so the three never drift apart. A customer's TIN and SST
// Reg. No. live in its KYC block (customer_onboarding), so the customer form
// shows only Currency and Bank here (`taxIds={false}`).
import { Input } from "@/components/ui/input";
import { partyCurrencyOptions, type PartyFinanceValue } from "@/lib/party-finance";

export function PartyFinanceFields({
  value,
  onChange,
  taxIds = true,
  labelClassName = "block text-xs text-[#6B7280] mb-1",
}: {
  value: PartyFinanceValue;
  onChange: (next: PartyFinanceValue) => void;
  /** false = the TIN / SST Reg. No. are kept elsewhere (a customer's KYC block). */
  taxIds?: boolean;
  labelClassName?: string;
}) {
  const set = (patch: Partial<PartyFinanceValue>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-party-finance-fields="">
      {taxIds && (
        <>
          <div>
            <label className={labelClassName}>TIN <span className="text-[#9CA3AF]">· e-Invoice</span></label>
            <Input value={value.tin} onChange={(e) => set({ tin: e.target.value })} placeholder="e.g. C2584563200" />
          </div>
          <div>
            <label className={labelClassName}>SST Reg. No. <span className="text-[#9CA3AF]">· e-Invoice</span></label>
            <Input value={value.sstRegNo} onChange={(e) => set({ sstRegNo: e.target.value })} placeholder="if registered" />
          </div>
        </>
      )}
      <div>
        <label className={labelClassName}>Currency</label>
        <select
          value={(value.currency || "MYR").toUpperCase()}
          onChange={(e) => set({ currency: e.target.value })}
          className="w-full rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#6B5C32]/20"
          aria-label="Currency"
        >
          {partyCurrencyOptions(value.currency).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClassName}>Bank &amp; account no.</label>
        <Input value={value.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })} placeholder="e.g. Maybank 5142 8820 1173" />
      </div>
    </div>
  );
}
