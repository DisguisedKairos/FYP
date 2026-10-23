data "aws_partition" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# Public Canonical parameter; no credentials or application secrets enter user data.
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/noble/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_vpc" "this" {
  cidr_block           = "10.64.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.deployment_name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.64.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "web" {
  name_prefix = "${var.deployment_name}-web-"
  description = "Public HTTP for certificate validation and HTTPS; no SSH ingress"
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "outbound" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_iam_role" "host" {
  name_prefix = "${var.deployment_name}-host-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "release" {
  name = "read-reviewed-release"
  role = aws_iam_role.host.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "arn:${data.aws_partition.current.partition}:s3:::${var.release_bucket}/${var.release_key}"
    }]
  })
}

resource "aws_iam_instance_profile" "host" {
  name_prefix = "${var.deployment_name}-"
  role        = aws_iam_role.host.name
}

resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  encrypted         = true
  type              = "gp3"
  size              = var.data_volume_size_gib
  tags              = { Name = "${var.deployment_name}-data" }

  # Deliberately requires an explicit operator change before destructive removal.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "host" {
  ami                    = nonsensitive(data.aws_ssm_parameter.ubuntu_ami.value)
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/bootstrap.sh.tftpl", {
    bootstrap_config = base64encode(jsonencode({
      region         = var.region
      domain         = var.domain
      bucket         = var.release_bucket
      key            = var.release_key
      sha256         = lower(var.release_sha256)
      data_volume_id = aws_ebs_volume.data.id
    }))
  })
  user_data_replace_on_change = true
  tags                        = { Name = var.deployment_name }

  depends_on = [aws_route_table_association.public, aws_iam_role_policy_attachment.ssm, aws_iam_role_policy.release]
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.host.id
  stop_instance_before_detaching = true
}

resource "aws_eip" "web" {
  domain = "vpc"
  tags   = { Name = var.deployment_name }
}

resource "aws_eip_association" "web" {
  instance_id   = aws_instance.host.id
  allocation_id = aws_eip.web.id
}
