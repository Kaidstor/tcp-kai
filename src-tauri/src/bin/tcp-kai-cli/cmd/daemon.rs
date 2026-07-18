//! `tcp-kai daemon` — управление keep-alive-демоном (пул TCP-соединений).

use std::process::ExitCode;
use std::time::Duration;

use clap::{Args, Subcommand};

use crate::daemon;

#[derive(Args)]
pub struct DaemonArgs {
    #[command(subcommand)]
    pub cmd: DaemonCmd,
}

#[derive(Subcommand)]
pub enum DaemonCmd {
    /// Запустить в форграунде (обычно не нужно: send поднимает демона сам)
    Run {
        /// Сколько секунд держать простаивающее соединение в пуле
        #[arg(long, value_name = "СЕК")]
        ttl: Option<u64>,
        /// Через сколько секунд без запросов выйти самому
        #[arg(long = "idle-exit", value_name = "СЕК")]
        idle_exit: Option<u64>,
    },
    /// Остановить демона
    Stop,
    /// Аптайм и пул соединений
    Status,
}

pub async fn run(args: DaemonArgs) -> Result<ExitCode, String> {
    let sock = daemon::socket_path();
    match args.cmd {
        DaemonCmd::Run { ttl, idle_exit } => {
            let (default_ttl, default_idle) = daemon::default_timings();
            daemon::serve(
                sock,
                ttl.map(Duration::from_secs).unwrap_or(default_ttl),
                idle_exit.map(Duration::from_secs).unwrap_or(default_idle),
            )
            .await?;
            Ok(ExitCode::SUCCESS)
        }
        DaemonCmd::Stop => {
            match daemon::call(&sock, &daemon::DaemonRequest::Stop, Some(Duration::from_secs(5)))
                .await
            {
                Ok(reply) => eprintln!("{}", reply.message),
                Err(_) => eprintln!("демон не запущен"),
            }
            Ok(ExitCode::SUCCESS)
        }
        DaemonCmd::Status => {
            match daemon::call(&sock, &daemon::DaemonRequest::Status, Some(Duration::from_secs(5)))
                .await
            {
                Ok(reply) => println!("{}", reply.message),
                Err(_) => println!("демон не запущен ({})", sock.display()),
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}
