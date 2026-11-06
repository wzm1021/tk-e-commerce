#!/usr/bin/env python3
"""Permit job containers to reach only the authenticated TLS gateway on the host bridge."""
import json,subprocess
def run(args,check=True):return subprocess.run(args,check=check,capture_output=True,text=True)
network=json.loads(run(['docker','network','inspect','tidelab-agent']).stdout)[0]
assert network['Internal'] is True
assert network['IPAM']['Config'][0]['Subnet']=='172.30.0.0/24'
bridge='br-'+network['Id'][:12]
chain='TIDELAB_AGENT_IN'
run(['iptables','-N',chain],False)
run(['iptables','-F',chain])
run(['iptables','-A',chain,'-d','172.30.0.1','-p','tcp','--dport','9443','-j','ACCEPT'])
run(['iptables','-A',chain,'-j','REJECT'])
if run(['iptables','-C','INPUT','-i',bridge,'-j',chain],False).returncode:
 run(['iptables','-I','INPUT','1','-i',bridge,'-j',chain])
