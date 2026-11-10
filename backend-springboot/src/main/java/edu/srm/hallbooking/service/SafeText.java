package edu.srm.hallbooking.service;

import java.util.regex.Pattern;

/**
 * Text people type (name, purpose, remarks) ends up in Camunda connector variables: in emails, and in the booking
 * register's requester field. The connector runtime replaces secret references in those variables, both
 * {{secrets.NAME}} and the bare form secrets.NAME, so a purpose typed as "secrets.SMTP_PASSWORD" would come back as the
 * password. Both forms need "secrets." with the dot right after the word; a space in between makes the text plain.
 */
public final class SafeText {

  private static final Pattern SECRET_REFERENCE = Pattern.compile("(?i)(secrets)\\.");

  private SafeText() {}

  public static String plain(String text) {
    return text == null ? "" : SECRET_REFERENCE.matcher(text).replaceAll("$1 .").trim();
  }

  /** For values that cannot be changed, such as an email address the email must be sent to. */
  public static boolean hasSecretReference(String text) {
    return text != null && SECRET_REFERENCE.matcher(text).find();
  }
}
