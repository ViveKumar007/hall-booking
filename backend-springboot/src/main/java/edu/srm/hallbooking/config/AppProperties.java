package edu.srm.hallbooking.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Settings under {@code app.*} in application.yaml (each can be overridden by an environment variable,
 * e.g. APP_MODELS_DIR).
 *
 * @param modelsDir folder with the BPMN, DMN and form files deployed at startup
 * @param deployModels whether to deploy them at startup
 * @param importFile json-server data file imported once when the register is empty (migration from the mock)
 * @param approvalMinutes how long an approver has before a review expires (must match PT2M in hall-approval.bpmn)
 * @param smtpHost mail server checked by /api/health
 * @param smtpPort mail server port checked by /api/health
 * @param camundaWebUrl base URL of Operate links shown to admins
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
    String modelsDir,
    boolean deployModels,
    String importFile,
    int approvalMinutes,
    String smtpHost,
    int smtpPort,
    String camundaWebUrl) {}
