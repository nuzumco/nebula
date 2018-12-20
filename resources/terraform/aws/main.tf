data "aws_availability_zones" "available" {}

module "vpc" {
  source = "./modules/vpc/public-only"

  name           = "${ var.application }-${var.run_identifier}-main-vpc"
  application    = "${ var.application }"
  provisionersrc = "${ var.provisionersrc }"

  # because australia doesn't have t3.medium in the a zone
  azs  = "${ slice(data.aws_availability_zones.available.names, 1, length(data.aws_availability_zones.available.names) - 1) }"
  cidr = "${ var.vpc_cidr_block }"
}