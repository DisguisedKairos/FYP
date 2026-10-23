variable "region" {
  description = "AWS region containing the existing release bucket."
  type        = string
  default     = "ap-southeast-1"
  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.region))
    error_message = "Provide an AWS region name."
  }
}

variable "deployment_name" {
  description = "Short resource name prefix."
  type        = string
  default     = "greenlink"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.deployment_name))
    error_message = "Use 3 to 25 lowercase letters, digits, or hyphens, starting with a letter."
  }
}

variable "domain" {
  description = "Public DNS hostname whose A record the operator will point to the output address."
  type        = string
  validation {
    condition     = length(var.domain) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain))
    error_message = "Provide a lowercase public DNS hostname, without a scheme, path, wildcard, or port."
  }
}

variable "release_bucket" {
  description = "Existing private S3 bucket containing the reviewed release ZIP (SSE-S3 encryption)."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.release_bucket))
    error_message = "Provide the S3 bucket name, without an s3:// prefix."
  }
}

variable "release_key" {
  description = "Exact S3 object key for the source ZIP, with project files at its root."
  type        = string
  validation {
    condition     = length(var.release_key) <= 1024 && can(regex("^[A-Za-z0-9][A-Za-z0-9_./-]*\\.zip$", var.release_key)) && !strcontains(var.release_key, "..")
    error_message = "Use a relative .zip key containing letters, digits, underscores, hyphens, dots, or slashes; no wildcards or '..'."
  }
}

variable "release_sha256" {
  description = "SHA-256 of the exact reviewed release ZIP. This is an integrity value, not a secret."
  type        = string
  validation {
    condition     = can(regex("^[a-fA-F0-9]{64}$", var.release_sha256))
    error_message = "Provide the complete 64-character SHA-256 hex digest."
  }
}

variable "instance_type" {
  description = "An x86_64 instance type; the packaged AMI and Compose binary target amd64."
  type        = string
  default     = "t3.small"
  validation {
    condition     = contains(["t3.small", "t3.medium", "t3.large", "t3a.small", "t3a.medium", "t3a.large"], var.instance_type)
    error_message = "Choose one of the documented t3/t3a small, medium, or large x86_64 instance types."
  }
}

variable "data_volume_size_gib" {
  description = "Encrypted, separately retained gp3 volume for databases, Docker data, and certificates."
  type        = number
  default     = 30
  validation {
    condition     = var.data_volume_size_gib >= 20 && var.data_volume_size_gib <= 1024 && floor(var.data_volume_size_gib) == var.data_volume_size_gib
    error_message = "Choose a whole number between 20 and 1024 GiB."
  }
}
