/* Default security group */
resource "aws_security_group" "swarm" {
  name        = "${var.application}-${var.run_identifier}-swarm-sg"
  description = "Default security group that allows inbound and outbound traffic from all instances in the VPC"
  vpc_id      = "${ module.vpc.id }"

  ingress {
    from_port   = "0"
    to_port     = "0"
    protocol    = "-1"
    self        = true
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["${var.incoming_ssh_cidr_blocks}"]
  }

  // Http api port
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  // Http ports
  ingress {
    from_port   = 8000
    to_port     = 8999
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  // Gossip ports
  ingress {
    from_port   = 4000
    to_port     = 4999
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }


  // All outbound traffic from any port
  egress {
    from_port   = "0"
    to_port     = "0"
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    self        = true
  }

  tags {
    Name = "${var.application}-swarm-sg"
  }
}

resource "aws_security_group" "ethereum" {
  name        = "${var.application}-${var.run_identifier}-ethereum-sg"
  description = "The Ethereum security group that allows inbound and outbound traffic from all instances in the VPC"
  vpc_id      = "${ module.vpc.id }"

  ingress {
    from_port   = "0"
    to_port     = "0"
    protocol    = "-1"
    self        = true
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["${var.incoming_ssh_cidr_blocks}"]
  }

  ingress {
    from_port   = 8545
    to_port     = 8545
    protocol    = "tcp"
    cidr_blocks = ["172.31.0.0/16"]
  }

  ingress {
    from_port   = 30303
    to_port     = 30303
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  // All outbound traffic from any port
  egress {
    from_port   = "0"
    to_port     = "0"
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    self        = true
  }


  tags {
    Name = "${var.application}-${var.run_identifier}-ethereum-sg"
  }
}
