# Review and verification limits

Reviewer: /root/uninstall_policy_review. Read-only current uncommitted diff against 7aa598856709f91d6fa327f4cbb94dc7192d9a5d.

Reviewed build/installer.nsh, scripts/verify-uninstall-hook.mjs, tests/unit/uninstall-policy-native.test.ts and installed builder templates. Confirmed predicate matches generated builder flags; ordinary replacement calls old uninstaller with /S /KEEP_APP_DATA --updated. Fixture target is isolated and three scoped scenarios preserve bytes.

Initial P1 under the author's overly broad "only interactive Yes deletes" wording: builder's surrounding uninstall section separately accepts --delete-app-data after the custom hook. Source locations: templates/nsis/uninstaller.nsh:219-243 and include/installUtil.nsh:202-230. Author checked original D-13 default-retention requirement and retained that explicit opt-in deletion exception, narrowed claims to ordinary silent/update invocations and the custom hook, documented contradictory combined flags unverified. Reviewer clarification: "I withdraw that finding; no blocking defect remains from this review." Ready subject to package checks, subsequently completed. This is clarification of the existing review, not a second independent review or test pass.

Set-aside scopes retained as unfinished: interactive default focus and explicit Yes/No, partial deletion under file locks, full installed-app reinstall, prior installed old uninstallers, unrelated model work. No user data or registry accessed by fixture. Existing old uninstallers cannot be changed retroactively by new source; first upgrade may show old prompt.

Tool limitations: both node_repl computer-use and cua_repl initialization failed with "failed to write kernel assets: 系统找不到指定的路径。 (os error 3)". No native UI actions performed. Did not bypass using external UI automation. NSIS button default was compiled and its official flag semantics inspected, not tested by pressing Enter.

Harness setup failures: Chinese absolute include paths failed; copying StdUtils into test directory and relative includes allowed correct compilation. Those setup attempts are not counted as product regressions. Original production macro was then compiled and actually hung in all three tested scenarios, timing out at five seconds. Owned processes stopped and profile hashes remained unchanged. New macro returns and preserves all four files.

Receipt script first failed with Error: "out/main/index.js" was not found in this archive because it converted Windows separators before passing the key to @electron/asar. Corrected the helper to pass native path; all 109 resources then matched source and previous package. This did not change app source or package contents.

GitHub connector search returned 422 inaccessible private repository. Existing authenticated GitHub CLI read all issues successfully: three OPEN, no comments. No issue writes.
