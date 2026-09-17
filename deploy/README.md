# Deploy to AWS

Runs the unmodified Logic Loop desktop app in a container on one EC2 host and
shows it in your browser through noVNC. No inbound AWS ports are open. Access is
an SSM port-forward and, optionally, a public HTTPS URL through Tailscale Funnel
behind a password. Anyone who gets in can use the app and every terminal in it.
Everyone who connects shares one desktop, one shell user, and one set of agent logins.

Requires the AWS CLI, the Session Manager plugin, and a default VPC in the region.

```bash
aws cloudformation deploy --stack-name logic-loop --template-file deploy/logic-loop.yaml --capabilities CAPABILITY_IAM --disable-rollback
```

The first deploy builds the app on the instance (about 15 to 30 minutes). The
stack reaches `CREATE_COMPLETE` only after the app window is up; a failed
build ends in `CREATE_FAILED` with the instance kept for debugging.

```bash
aws cloudformation describe-stacks --stack-name logic-loop --query "Stacks[0].Outputs" --output table
```

Run the `ConnectCommand` output, leave it open, then browse to the `Url` output.
Open a tab in the app and run `claude` to log in. The home directory, including
agent logins and the Logic Loop database, lives in the `logic-loop-home` Docker volume.

## Public URL (optional)

Before deploying, in the Tailscale admin console: enable HTTPS certificates and
Funnel for the tailnet, and create an auth key. Store the key in SSM (replace
the value when you paste it into your terminal):

```bash
aws ssm put-parameter --name /logic-loop/tailscale-auth-key --type SecureString --value tskey-auth-REPLACE_ME
```

When that parameter exists, the deploy also joins the tailnet as `logic-loop`,
puts Caddy basic auth in front of noVNC, and turns on Funnel. The stack only
completes if the URL returns 401 without the password and 200 with it. The
password is generated on first boot and stored in SSM; print it with the
`WebPasswordCommand` output. Then open `https://logic-loop.<tailnet>.ts.net`
and sign in as `logicloop`.

To rotate the password, delete `/logic-loop/web-password` and redeploy. To turn
the public URL off, run `sudo tailscale funnel --https=443 off` on the instance.

Debug a failed build (delete the stack before redeploying):

```bash
aws ssm start-session --target INSTANCE_ID
```

```bash
sudo tail -n 80 /var/log/cloud-init-output.log
```

Known limits on Linux: desktop notifications and the dock badge do nothing.

Tear down (deletes the instance and its volume; the two SSM parameters and the
Tailscale machine entry are left for you to remove):

```bash
aws cloudformation delete-stack --stack-name logic-loop
```
