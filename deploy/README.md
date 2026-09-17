# Deploy to AWS

Runs the unmodified Logic Loop desktop app in a container on one EC2 host and
shows it in your browser through noVNC. No inbound ports are open; access is an
SSM port-forward, so whoever can start an SSM session on the instance can use
the app (and every terminal in it).

Requires the AWS CLI, the Session Manager plugin, and a default VPC in the region.

```bash
aws cloudformation deploy --stack-name logic-loop --template-file deploy/logic-loop.yaml --capabilities CAPABILITY_IAM --disable-rollback
```

The first deploy builds the app on the instance (about 25 to 35 minutes; add
`--parameter-overrides InstanceType=m6i.xlarge` to roughly halve the Rust build). The
stack reaches `CREATE_COMPLETE` only after the app window is up; a failed
build ends in `CREATE_FAILED` with the instance kept for debugging.

```bash
aws cloudformation describe-stacks --stack-name logic-loop --query "Stacks[0].Outputs" --output table
```

Run the `ConnectCommand` output, leave it open, then browse to the `Url` output.
Open a tab in the app and run `claude` to log in. The home directory, including
agent logins and the Logic Loop database, lives in the `logic-loop-home` Docker volume.

Debug a failed build (delete the stack before redeploying):

```bash
aws ssm start-session --target INSTANCE_ID
```

```bash
sudo tail -n 80 /var/log/cloud-init-output.log
```

Known limits on Linux: desktop notifications and the dock badge do nothing.

Tear down (deletes the instance and its volume):

```bash
aws cloudformation delete-stack --stack-name logic-loop
```
