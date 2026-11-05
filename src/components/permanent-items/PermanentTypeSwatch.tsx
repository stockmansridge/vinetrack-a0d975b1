export default function PermanentTypeSwatch({ color }: { color?: string }) {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="inline-block shrink-0 align-middle text-primary"><circle cx="7" cy="7" r="6" fill={color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'currentColor'} stroke="currentColor" /></svg>;
}