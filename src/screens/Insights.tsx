/**
 * Insights screen — stub.
 *
 * Time-consumption charts and routine streak history land in a later
 * chunk; chunk 6 only wires the tab so navigation works end-to-end.
 */
export default function Insights() {
  return (
    <div>
      <div className="label mb-2">Insights</div>
      <h1
        className="mb-3 text-[28px] font-semibold"
        style={{ letterSpacing: '-0.02em' }}
      >
        Insights
      </h1>
      <p className="text-[13px] text-muted-foreground">Coming soon.</p>
    </div>
  )
}
