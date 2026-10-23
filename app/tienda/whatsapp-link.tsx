export function WhatsappLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: string;
  className?: string;
}) {
  return (
    <a className={className ? `vsa-whatsapp ${className}` : "vsa-whatsapp"} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
