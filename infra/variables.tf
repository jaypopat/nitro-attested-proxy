variable "region" {
  description = "AWS region. us-east-1 is cheapest; switch to eu-west-1/eu-west-2 for lower SSH latency from Europe."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Must support Nitro Enclaves. m5.xlarge is the smallest sensible option."
  type        = string
  default     = "m5.xlarge"
}

variable "allowed_cidr" {
  description = "CIDR allowed to reach SSH (22) and the proxy (8000). Lock to <your-ip>/32 for anything beyond a short demo."
  type        = string
  default     = "0.0.0.0/0"
}

variable "name" {
  description = "Name tag prefix applied to all resources."
  type        = string
  default     = "attested-proxy"
}
