#!/usr/bin/env node
/** Stand-in for an `ego-browser` that answers every invocation with usage. */
process.stderr.write('Usage:\n  ego-browser <<\'JS\'\n')
process.exit(2)
