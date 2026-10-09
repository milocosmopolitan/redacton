# Independent pilot plan, issue #13

Status: plan only. No independent installation, participant consent, seven-day repeat use, or adoption result is claimed. Begin only after #12's qualified artifact and its license/reporting/compatibility gates pass. No participant has been contacted by this work.

## Participants and consent

Recruit three independent Claude Code users with authorized outreach. Maintainer demonstrations, subagents, CI jobs, downloads, and simulated participants do not count. Give participants the actual beta limitations, supported platform/version, tool coverage, ON/OFF behavior, host fallback risk, and privacy disclosures before consent.

Use newly authored synthetic prompt/tool examples. Do not request live credentials, production transcripts, customer data, screenshots with sensitive material, or unrestricted logs. There is no automatic telemetry. Participants opt into providing limited safe feedback and can decline, withdraw, or omit any item. Agree how long feedback is retained and who can read it before collection; do not imply anonymity from simply omitting a name.

## Schedule and observations

Day 0: record an opaque participant ID, exact artifact ID, Claude Code/Node version, platform/architecture, independent installation result, and elapsed time to the first protected synthetic operation. Observe onboarding comprehension, requested ON versus readiness, /redacton and /redactoff, persistent OFF-warning visibility, a supported prompt/Read/Bash exercise, and a safe failure exercise. Record task completion, visible disruption/false positives, and participant-reported latency using categories or measured elapsed time without input text.

Ask what currently prevents leakage, where failures would matter, what would prevent adoption, and whether the participant intends to keep protection enabled. Ask for a concrete continuing workflow rather than a general endorsement.

Day 7 or later: record whether they used it again, whether it remains enabled, reasons for disabling/uninstalling, installation/host/latency friction, and the continuing workflow they want. Record the actual elapsed days. An early response is not seven-day repeat-use evidence; a nonresponse stays missing.

## Safe optional feedback form

Collect only consented fields in a private agreed channel. The form is a manual template, not instrumentation:

```json
{
  "participantId": "pilot-01",
  "consentRecorded": false,
  "artifactId": "",
  "hostVersion": "",
  "nodeVersion": "",
  "platform": "",
  "independentInstallation": null,
  "firstProtectedOperationSeconds": null,
  "taskCompleted": null,
  "offWarningVisible": null,
  "readinessUnderstood": null,
  "latencyCategory": "unknown",
  "falsePositiveDisruption": "unknown",
  "daysAfterInstallation": null,
  "repeatUse": null,
  "stillEnabled": null,
  "disablingReasonCategory": "unknown",
  "continuingWorkflowCategory": "unknown"
}
```

Do not copy participant text into a public issue without explicit publication consent and a sensitive-data review. Prefer coarse categories and remove identifying host paths, credentials, and incident details. No script sends messages or feedback automatically.

## Decision and completion

The proposed positive learning signal is at least two of the three users keeping protection enabled and requesting a concrete continuing workflow. A failure signal is no repeated use, or host/latency friction defeating the task. These signals are learning targets, not market size or product-security proof.

Decide MCP-result Beta 1 go/no-go using the actual observed demand and separately qualified interception feasibility. Complete #13 only after three independent installation records, consented observations, the seven-day follow-up evidence or documented outcomes, and a concrete decision exist. Keep missing evidence visible; do not fabricate successful repeat use to satisfy a checklist.
