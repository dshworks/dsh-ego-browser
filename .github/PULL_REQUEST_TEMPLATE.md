## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem, not the patch. -->

## What you actually ran

<!-- Paste the output. "npm test" with no output pasted is not a claim. -->

```
$ npm test

```

- [ ] `npm test` passes (the claims tripwire in `tests/claims.spec.mjs` will fail
      the build if this PR made a README number stale — that is the point)
- [ ] New behaviour has a test that fails without the change
- [ ] If a README claim changed, both `README.md` and `README.zh.md` changed
- [ ] If this touches the `ego-browser` wire and you have a real install, the
      `ego_doctor` output is pasted above
