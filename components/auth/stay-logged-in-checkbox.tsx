type StayLoggedInCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  className?: string;
};

/** Default for fresh login forms — opt-out persistent session on trusted devices. */
export const DEFAULT_STAY_LOGGED_IN = true;

export default function StayLoggedInCheckbox({
  checked,
  onChange,
  id = "stay-logged-in",
  className = "",
}: StayLoggedInCheckboxProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
        />
        <span className="text-sm text-zinc-700">
          <span className="font-medium text-zinc-900">Stay logged in</span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            Keep me signed in on this device until I log out. Only use on
            trusted devices.
          </span>
        </span>
      </label>
    </div>
  );
}
