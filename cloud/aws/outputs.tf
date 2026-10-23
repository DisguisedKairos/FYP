output "public_ipv4" {
  description = "Set the domain's public A record to this address."
  value       = aws_eip.web.public_ip
}

output "public_origin" {
  value = "https://${var.domain}"
}

output "instance_id" {
  value = aws_instance.host.id
}

output "data_volume_id" {
  description = "Retained encrypted application volume; include it in backup and recovery plans."
  value       = aws_ebs_volume.data.id
}

output "session_command" {
  description = "Requires operator IAM permission and the AWS Session Manager plugin."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.host.id}"
}
