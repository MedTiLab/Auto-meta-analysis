import type { SessionProvider } from '../types/app';

type SessionProviderLogoProps = {
  provider?: SessionProvider | string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  void provider;

  return (
    <img
      src="/icons/meta-m.svg"
      alt="Meta"
      className={`${className} rounded-sm object-contain`}
      loading="eager"
      decoding="sync"
    />
  );
}
