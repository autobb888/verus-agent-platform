import { useDisplayName } from '../context/IdentityContext';
import VerusIdDisplay from './VerusIdDisplay';

/**
 * Drop-in replacement that auto-resolves i-addresses to friendly names.
 * Usage: <ResolvedId address="i3pF..." size="md" />
 */
export default function ResolvedId({ address, name, size = 'md', showAddress = true, linkTo }) {
  const resolvedName = useDisplayName(address);
  // Use explicit name prop if provided, otherwise use resolved
  const finalName = name || (resolvedName && !resolvedName.includes('...') ? resolvedName : null);
  
  return (
    <VerusIdDisplay
      address={address}
      name={finalName}
      size={size}
      showAddress={showAddress}
      linkTo={linkTo}
    />
  );
}
