/**
 * SQL for the year `formatDate` shows.
 *
 * Local midnight on January 1 is the old year-only placeholder and uses the
 * local year. A stored year, or a UTC-noon calendar day from a folder scan,
 * uses the UTC year. Anything else uses the local year.
 *
 * The expression reads `release_date` and `release_precision` on `alias`.
 */
export function releaseYearSql(alias = 'e'): string {
  const millis = `${alias}.release_date`
  const seconds = `${millis} / 1000`
  const wholeSecond = `(${millis} % 1000) = 0`
  const localStamp = `strftime('%m-%d %H:%M:%S', ${seconds}, 'unixepoch', 'localtime')`
  const utcTime = `strftime('%H:%M:%S', ${seconds}, 'unixepoch')`
  const localYear = `CAST(strftime('%Y', ${seconds}, 'unixepoch', 'localtime') AS INTEGER)`
  const utcYear = `CAST(strftime('%Y', ${seconds}, 'unixepoch') AS INTEGER)`
  return `CASE
    WHEN ${millis} IS NULL THEN NULL
    WHEN ${wholeSecond} AND ${localStamp} = '01-01 00:00:00' THEN ${localYear}
    WHEN ${alias}.release_precision = 'year'
      OR (${wholeSecond} AND ${utcTime} = '12:00:00') THEN ${utcYear}
    ELSE ${localYear}
  END`
}
