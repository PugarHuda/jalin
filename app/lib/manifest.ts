import source from '../../strk20.json'

/**
 * The submission's own `strk20.json`, imported rather than read.
 *
 * The three qualifying hashes were only ever in that file and on `/verify`, so
 * the page making the case for them never showed one. Copying them into a
 * constant here would fix the display and introduce the drift the manifest
 * exists to prevent: the file is what the panel reads, so the file is what the
 * page reads.
 *
 * The first version of this read the file at runtime with `readFileSync` and a
 * couple of candidate paths relative to `process.cwd()`. That works locally and
 * fails on the deploy, which is exactly the shape of bug that ships: a
 * serverless function's working directory is not the repository root, and
 * nothing traced `strk20.json` into the bundle because nothing imported it. The
 * page said so out loud rather than rendering a gap - the failure state earned
 * its place within a day of being written - but saying it on production is not
 * the job.
 *
 * Importing it makes the bundler carry the file, so the data is in the build
 * and there is no filesystem at runtime to get wrong.
 */
export interface Manifest {
  transactions: string[]
  contracts: string[]
  demo_video?: string
  demo_url?: string
}

/**
 * Null only when the manifest carries no transactions at all, which is a real
 * submission error rather than a read that failed. Callers render the same
 * honest line either way.
 */
export const manifest: Manifest | null =
  Array.isArray(source?.transactions) && source.transactions.length > 0
    ? (source as Manifest)
    : null
