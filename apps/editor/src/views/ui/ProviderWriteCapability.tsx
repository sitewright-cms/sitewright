import { toggleInput } from '../../theme';

interface ProviderWriteCapabilityProps {
  checked: boolean;
  onToggle: () => void;
}

/**
 * The opt-in `payments:provider:write` capability on a token form — offered to INSTANCE ADMINS only.
 *
 * It lets an agent write payment PROVIDER definitions, which are shared by every project on the
 * instance, and the API honours it only on a token whose owner is an instance admin. Showing it to
 * anyone else would offer a box that does nothing.
 */
export function ProviderWriteCapability({ checked, onToggle }: ProviderWriteCapabilityProps) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
      <input type="checkbox" className={`${toggleInput} mt-0.5`} checked={checked} onChange={onToggle} />
      <span>
        <span className="font-medium text-slate-700 dark:text-slate-200">payments:provider:write</span>
        <span className="block text-slate-500 dark:text-slate-400">
          Write payment provider definitions for the whole instance. A person still proves each new provider with a test
          checkout before it takes live money. A token cannot change a live provider, nor any provider a project has
          entered keys for.
        </span>
      </span>
    </label>
  );
}
