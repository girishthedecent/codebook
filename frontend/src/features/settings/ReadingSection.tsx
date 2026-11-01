import { usePref, type Measure, type TextSize } from '@/lib/prefs';
import { RadioGroup, SectionHeading } from '@/ui';
import { strings } from '@/features/account/strings';

const s = strings.settings.reading;
const SIZES: TextSize[] = ['s', 'm', 'l'];
const MEASURES: Measure[] = ['narrow', 'wide'];
// Each size label is set at the size it stands for, in the reading face.
const LABEL_SIZE: Record<TextSize, string> = { s: '1rem', m: '1.0625rem', l: '1.1875rem' };

export function ReadingSection() {
  const [size, setSize] = usePref('textSize');
  const [measure, setMeasure] = usePref('measure');
  return (
    <section aria-labelledby="reading">
      <SectionHeading id="reading" hint={s.hint}>
        {s.title}
      </SectionHeading>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 id="reading-size" className="text-xs font-medium text-ink">
            {s.size}
          </h3>
          <RadioGroup
            aria-labelledby="reading-size"
            value={size}
            onValueChange={(value) => setSize(value as TextSize)}
            options={SIZES.map((value) => ({
              value,
              label: (
                <span className="font-serif leading-tight" style={{ fontSize: LABEL_SIZE[value] }}>
                  {s.sizes[value]}
                </span>
              ),
            }))}
          />
        </div>
        <div>
          <h3 id="reading-measure" className="text-xs font-medium text-ink">
            {s.measure}
          </h3>
          <RadioGroup
            aria-labelledby="reading-measure"
            value={measure}
            onValueChange={(value) => setMeasure(value as Measure)}
            options={MEASURES.map((value) => ({
              value,
              label: s.measures[value][0],
              description: s.measures[value][1],
            }))}
          />
        </div>
      </div>
      <figure className="m-0 mt-5 rounded-md border border-rule bg-paper-2 px-5 py-4">
        <figcaption className="mb-2 text-xs text-ink-3">{s.sampleLabel}</figcaption>
        <p className="prose text-ink">{s.sample}</p>
      </figure>
    </section>
  );
}
