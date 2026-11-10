/**
 * What a class-list file must contain, for the two screens that take one.
 *
 * It replaces one run-on sentence that carried the nine column names inside
 * it, so the header read as prose rather than as the row it is — and on the
 * roster screen the sentence after it began lowercase, because the header's
 * full stop was never meant to end one. The columns are the file's first line,
 * so they are drawn as a line and numbered, since the order is what matters;
 * the three rules that decide whether a row is accepted are drawn against the
 * column each one belongs to, rather than listed after a semicolon.
 *
 * The header is passed in rather than written here. `ROSTER_HEADER` in
 * `web/csv.ts` is the workspace's one copy of these columns, and
 * `tests/registry-address.test.ts` asserts it equals what
 * `GET /roster-imports/template` publishes; a second copy here would be the
 * one that goes stale.
 */
export function FileRules({ header }: { header: string }) {
  const columns = header.split(',');
  return (
    <div className="file-rules">
      <p className="file-rules-lede">The EDUNEXUS Excel template, or a CSV file whose first line is exactly these {columns.length} columns, in this order:</p>
      <ol className="file-rules-cols">
        {columns.map(column => <li key={column} className="mono">{column}</li>)}
      </ol>
      <dl className="file-rules-list">
        <div><dt className="mono">lrn</dt><dd>All twelve digits, kept as text. Every learner needs one.</dd></div>
        <div><dt className="mono">birth_date</dt><dd>Written <b className="mono">YYYY-MM-DD</b>, such as <b className="mono">2019-07-04</b>.</dd></div>
        <div><dt className="mono">sex</dt><dd><b className="mono">male</b> or <b className="mono">female</b>.</dd></div>
      </dl>
    </div>
  );
}
