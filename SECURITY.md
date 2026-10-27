# Security Policies and Procedures

This document outlines security procedures and general policies for the OOXML Toolkit project.

- [Supported versions](#supported-versions)
- [Disclosing a security issue](#disclosing-a-security-issue)
- [Vulnerability management](#vulnerability-management)
- [Suggesting changes](#suggesting-changes)

## Supported versions

Security fixes are made for the latest release only. Please make sure the issue still occurs with the
[latest release](https://github.com/DominikPalo/OOXML-Toolkit/releases/latest) before reporting it.

## Disclosing a security issue

The OOXML Toolkit maintainers take all security issues in the project seriously. Thank you for
improving the security of OOXML Toolkit. We appreciate your dedication to responsible disclosure and
will make every effort to acknowledge your contributions.

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull
requests.**

OOXML Toolkit leverages GitHub's private vulnerability reporting: open the
[Security tab](https://github.com/DominikPalo/OOXML-Toolkit/security) of the repository and click
**Report a vulnerability**. To learn more about this feature, review
[GitHub's documentation on private reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

Here are some helpful details to include in your report:

- a detailed description of the issue
- the steps required to reproduce the issue (for example a crafted document — please do not attach
  files that contain confidential or personal data)
- versions of the project and operating systems that may be affected by the issue
- if known, any mitigations for the issue

A maintainer will acknowledge the report within three (3) business days, and will send a more detailed
response within an additional three (3) business days indicating the next steps in handling your
report.

If you've been unable to successfully draft a vulnerability report via GitHub or have not received a
response during the allotted response window, please reach out by email to
[dominik@palo.sk](mailto:dominik@palo.sk).

After the initial reply to your report, the maintainers will endeavor to keep you informed of the
progress towards a fix and full announcement, and may ask for additional information or guidance.

## Vulnerability management

When the maintainers receive a disclosure report, they will assign it to a primary handler.

This person will coordinate the fix and release process, which involves the following steps:

- confirming the issue
- determining affected versions of the project
- auditing code to find any potential similar problems
- preparing fixes and publishing a new release

## Suggesting changes

If you have suggestions on how this process could be improved please submit an issue or pull request.
