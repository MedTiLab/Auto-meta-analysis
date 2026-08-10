args <- commandArgs(trailingOnly = TRUE)

get_arg <- function(flag) {
  idx <- match(flag, args)
  if (is.na(idx) || idx == length(args)) {
    return(NULL)
  }
  args[[idx + 1]]
}

input_path <- get_arg("--input")
output_dir <- get_arg("--output")

if (is.null(input_path) || is.null(output_dir)) {
  stop("--input and --output are required")
}

dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

data <- read.csv(input_path, stringsAsFactors = FALSE)
required <- c("TP", "FP", "FN", "TN")
missing_cols <- setdiff(required, names(data))
if (length(missing_cols) > 0) {
  stop(paste("Missing required columns:", paste(missing_cols, collapse = ", ")))
}

complete <- data[complete.cases(data[, required]), ]
if (nrow(complete) < 2) {
  stop("At least 2 complete studies with TP/FP/FN/TN are required")
}

complete$TP <- as.numeric(complete$TP)
complete$FP <- as.numeric(complete$FP)
complete$FN <- as.numeric(complete$FN)
complete$TN <- as.numeric(complete$TN)
complete$sensitivity_calc <- complete$TP / (complete$TP + complete$FN)
complete$specificity_calc <- complete$TN / (complete$TN + complete$FP)

wilson_ci <- function(x, n) {
  if (n <= 0) return(c(NA, NA))
  z <- 1.96
  p <- x / n
  denom <- 1 + z^2 / n
  center <- (p + z^2 / (2 * n)) / denom
  half <- z * sqrt((p * (1 - p) / n) + (z^2 / (4 * n^2))) / denom
  c(max(0, center - half), min(1, center + half))
}

pooled_sens <- sum(complete$TP) / sum(complete$TP + complete$FN)
pooled_spec <- sum(complete$TN) / sum(complete$TN + complete$FP)
sens_ci <- wilson_ci(sum(complete$TP), sum(complete$TP + complete$FN))
spec_ci <- wilson_ci(sum(complete$TN), sum(complete$TN + complete$FP))
dor_values <- ((complete$TP + 0.5) * (complete$TN + 0.5)) / ((complete$FP + 0.5) * (complete$FN + 0.5))
pooled_dor <- exp(mean(log(dor_values), na.rm = TRUE))

write.csv(complete, file.path(output_dir, "diagnostic_summary.csv"), row.names = FALSE)

png(file.path(output_dir, "forest_sensitivity.png"), width = 1100, height = 800)
par(mar = c(5, 10, 4, 2))
plot(complete$sensitivity_calc, seq_len(nrow(complete)), xlim = c(0, 1), yaxt = "n",
     xlab = "Sensitivity", ylab = "", main = "Forest plot: sensitivity", pch = 19)
axis(2, at = seq_len(nrow(complete)), labels = complete$study_id, las = 2, cex.axis = 0.8)
abline(v = pooled_sens, col = "red", lwd = 2)
dev.off()

png(file.path(output_dir, "forest_specificity.png"), width = 1100, height = 800)
par(mar = c(5, 10, 4, 2))
plot(complete$specificity_calc, seq_len(nrow(complete)), xlim = c(0, 1), yaxt = "n",
     xlab = "Specificity", ylab = "", main = "Forest plot: specificity", pch = 19)
axis(2, at = seq_len(nrow(complete)), labels = complete$study_id, las = 2, cex.axis = 0.8)
abline(v = pooled_spec, col = "red", lwd = 2)
dev.off()

png(file.path(output_dir, "sroc.png"), width = 900, height = 700)
plot(1 - complete$specificity_calc, complete$sensitivity_calc, xlim = c(0, 1), ylim = c(0, 1),
     xlab = "1 - Specificity", ylab = "Sensitivity", main = "SROC")
points(1 - pooled_spec, pooled_sens, col = "red", pch = 19, cex = 1.5)
abline(0, 1, lty = 2, col = "gray")
dev.off()

png(file.path(output_dir, "deeks_funnel.png"), width = 900, height = 700)
effective_n <- 1 / ((1 / (complete$TP + complete$FN)) + (1 / (complete$TN + complete$FP)))
plot(sqrt(effective_n), log(dor_values), xlab = "sqrt effective sample size",
     ylab = "log diagnostic odds ratio", main = "Deeks funnel plot (exploratory)")
dev.off()

json <- sprintf(
  paste0(
    '{\n',
    '  "analysis_type": "diagnostic",\n',
    '  "n_studies": %d,\n',
    '  "pooled_sensitivity": {"estimate": %.6f, "ci_low": %.6f, "ci_high": %.6f},\n',
    '  "pooled_specificity": {"estimate": %.6f, "ci_low": %.6f, "ci_high": %.6f},\n',
    '  "pooled_dor": {"estimate": %.6f},\n',
    '  "heterogeneity": {},\n',
    '  "figures": ["forest_sensitivity.png", "forest_specificity.png", "sroc.png", "deeks_funnel.png"],\n',
    '  "warnings": []\n',
    '}\n'
  ),
  nrow(complete),
  pooled_sens, sens_ci[[1]], sens_ci[[2]],
  pooled_spec, spec_ci[[1]], spec_ci[[2]],
  pooled_dor
)

writeLines(json, file.path(output_dir, "output.json"))
cat(json)
