import { Link, type Href } from 'expo-router';
import { ActionButton } from './ActionButton';

export function ActionLink({ href, label, hint }: { href: Href; label: string; hint?: string }) {
  return (
    <Link href={href} asChild>
      <ActionButton label={label} variant="secondary" accessibilityRole="link" accessibilityHint={hint} />
    </Link>
  );
}
