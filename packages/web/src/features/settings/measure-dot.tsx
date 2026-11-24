/** The dot on the Measure tab while a measurement runs. It stays until the run ends, wherever the person is. */
export function MeasuringDot() {
  return (
    <>
      <span aria-hidden="true" data-measuring="" className="ml-1.5 inline-block size-1.5 rounded-full bg-clay align-middle" />
      <span className="sr-only"> (a measurement is running)</span>
    </>
  );
}
