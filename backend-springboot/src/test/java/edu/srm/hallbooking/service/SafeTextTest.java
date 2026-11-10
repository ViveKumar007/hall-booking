package edu.srm.hallbooking.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** Typed text must never contain a secret reference the connector runtime would fill in. */
class SafeTextTest {

  /** What the connector runtime looks for: {{secrets.NAME}} and the bare secrets.NAME. */
  private static final Pattern RUNTIME = Pattern.compile("secrets\\.[A-Za-z0-9]");

  @Test
  void bothSecretSyntaxesAreMadePlain() {
    for (String typed : new String[] {"{{secrets.SMTP_PASSWORD}}", "see secrets.SMTP_PASSWORD", "{{ secrets.MAIL_FROM }}",
        "SECRETS.smtp_password", "secrets .X then secrets.Y"}) {
      String safe = SafeText.plain(typed);
      assertThat(RUNTIME.matcher(safe).find()).as(typed + " -> " + safe).isFalse();
      assertThat(SafeText.hasSecretReference(safe)).isFalse();
    }
  }

  @Test
  void ordinaryTextIsKept() {
    assertThat(SafeText.plain("  Workshop on cloud computing, day 2 of 3. ")).isEqualTo("Workshop on cloud computing, day 2 of 3.");
    assertThat(SafeText.plain(null)).isEmpty();
    assertThat(SafeText.hasSecretReference("dean@college.edu")).isFalse();
    assertThat(SafeText.hasSecretReference("secrets.smtp@evil.example")).isTrue();
  }
}
