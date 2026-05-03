output "instance_ip" {
  description = "Public IP of the enclave host."
  value       = aws_instance.this.public_ip
}

output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.this.id
}

output "ssh_command" {
  description = "Convenience SSH command using the generated key."
  value       = "ssh -i ${path.module}/ssh_key.pem ec2-user@${aws_instance.this.public_ip}"
}
