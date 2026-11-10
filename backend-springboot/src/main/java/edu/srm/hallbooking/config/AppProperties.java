package edu.srm.hallbooking.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Settings under {@code app.*} in application.yaml (each can be overridden by an environment variable,
 * e.g. APP_MODELS_DIR).
 *
 * @param modelsDir folder with the BPMN, DMN and form files deployed at startup
 * @param deployModels whether to deploy them at startup
 * @param importFile json-server data file imported once when the register is empty (migration from the mock)
 * @param approvalTimeout how long an approver has before a review expires (APPROVAL_TIMEOUT, default 1 day)
 * @param approvalReminder when the reminder goes out (APPROVAL_REMINDER, default after 1 hour)
 * @param smtpHost mail server checked by /api/health
 * @param smtpPort mail server port checked by /api/health
 * @param camundaWebUrl base URL of Operate links shown to admins
 * @param accounts roles by Google account, "email=role+role;email=role" (APP_ACCOUNTS in secrets.cmd)
 * @param registerKey key the REST connectors send as X-Register-Key; empty = register open (local tests only)
 * @param devLoginEnabled test-only login without Google (POST /api/auth/dev-login)
 * @param url address of the app, for the links in the update emails (APP_URL)
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
    String modelsDir,
    boolean deployModels,
    String importFile,
    java.time.Duration approvalTimeout,
    java.time.Duration approvalReminder,
    String smtpHost,
    int smtpPort,
    String camundaWebUrl,
    String accounts,
    String registerKey,
    boolean devLoginEnabled,
    String url) {}
