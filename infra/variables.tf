variable "region" {
  description = "AWS region. eu-west-1 (Ireland)"
  type        = string
  default     = "eu-west-1"
}

variable "instance_type" {
  description = "Must support Nitro Enclaves and have >= 4 vCPUs. c5.xlarge is the cheapest option that fits."
  type        = string
  default     = "c5.xlarge"
}

variable "allowed_cidr" {
  description = "CIDR allowed to reach SSH (22) and the proxy (8000). Change later perhaps"
  type        = string
  default     = "0.0.0.0/0"
}

variable "name" {
  description = "Name tag prefix applied to all resources."
  type        = string
  default     = "attested-proxy"
}
