/** The eyebrow-pill + display heading + subtitle pattern repeated at the
 * top of every main page. One place to keep size/spacing consistent. */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="pill">{eyebrow}</p>
      <h1 className="display-type mt-3 text-4xl font-bold text-slate-900 sm:text-5xl">{title}</h1>
      {subtitle && <p className="mt-3 text-slate-600">{subtitle}</p>}
    </div>
  );
}
